'use strict';
const axios = require('axios');
const { MongoClient } = require('mongodb');
const crypto = require('crypto');

// Function to anonymize IP addresses
const anonymizeIP = (ip) => {
  return crypto.createHash('sha256').update(ip).digest('hex');
};

// Function to get stock price
const getStockPrice = async (symbol) => {
  try {
    const response = await axios.get(`https://stock-price-checker-proxy.freecodecamp.rocks/v1/stock/${symbol}/quote`);
    return {
      symbol: response.data.symbol,
      price: response.data.latestPrice
    };
  } catch (error) {
    console.error(`Error fetching stock price for ${symbol}:`, error.message);
    return { symbol, price: 'N/A' };
  }
};

// Using an in-memory MongoDB for testing
let stockData = {};

// Function to simulate database operations
const simulateDB = {
  findOne: async (query) => {
    const symbol = query.symbol;
    return stockData[symbol] || null;
  },
  insertOne: async (doc) => {
    stockData[doc.symbol] = doc;
    return { insertedId: doc.symbol };
  },
  updateOne: async (query, update) => {
    const symbol = query.symbol;
    if (stockData[symbol]) {
      if (update.$addToSet && update.$addToSet.likes) {
        if (!stockData[symbol].likes) {
          stockData[symbol].likes = [];
        }
        const ipToAdd = update.$addToSet.likes;
        if (!stockData[symbol].likes.includes(ipToAdd)) {
          stockData[symbol].likes.push(ipToAdd);
        }
      }
    }
    return { modifiedCount: 1 };
  }
};

// Mock database connection for testing
const connectToDatabase = async () => {
  return {
    collection: (name) => {
      return simulateDB;
    }
  };
};

module.exports = function (app) {
  app.route('/api/stock-prices')
    .get(async function (req, res) {
      try {
        const { stock, like } = req.query;
        const clientIP = anonymizeIP(req.ip);
        const db = await connectToDatabase();
        const stockCollection = db.collection('stocks');
        
        // Handle single or multiple stock requests
        const stocks = Array.isArray(stock) ? stock : [stock];
        
        // Process likes and get stock data
        const results = await Promise.all(stocks.map(async (symbol) => {
          const stockData = await getStockPrice(symbol);
          let likes = 0;
          
          if (stockData.price !== 'N/A') {            // Get current likes
            const stockRecord = await stockCollection.findOne({ symbol: symbol.toUpperCase() });
            
            if (stockRecord) {
              // Initialize likes array if it doesn't exist
              if (!stockRecord.likes) {
                stockRecord.likes = [];
              }
              
              likes = stockRecord.likes.length;
              
              // Process like if requested
              if (like && !stockRecord.likes.includes(clientIP)) {
                await stockCollection.updateOne(
                  { symbol: symbol.toUpperCase() }, 
                  { $addToSet: { likes: clientIP } }
                );
                likes++;
              }
            } else {
              // Create new stock record if it doesn't exist
              await stockCollection.insertOne({
                symbol: symbol.toUpperCase(),
                likes: like ? [clientIP] : []
              });
              
              if (like) likes = 1;
            }
          }
          
          return { ...stockData, likes };
        }));
          // Format response based on number of stocks
        if (results.length === 1) {
          res.json({ stockData: results[0] });
        } else if (results.length === 2) {
          const rel_likes = [
            results[0].likes - results[1].likes,
            results[1].likes - results[0].likes
          ];
          
          res.json({
            stockData: [
              { stock: results[0].symbol, price: results[0].price, rel_likes: rel_likes[0] },
              { stock: results[1].symbol, price: results[1].price, rel_likes: rel_likes[1] }
            ]
          });
        } else {
          res.status(400).json({ error: 'Invalid request' });
        }
      } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({ error: 'Server error' });
      }
    });
};
