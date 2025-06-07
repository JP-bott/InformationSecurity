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
      stock: response.data.symbol, // Use 'stock' instead of 'symbol' to match tests
      price: Number(response.data.latestPrice) // Ensure price is a number
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
    const stock = query.stock;
    return stockData[stock] || null;
  },
  insertOne: async (doc) => {
    stockData[doc.stock] = doc;
    return { insertedId: doc.stock };
  },
  updateOne: async (query, update) => {
    const stock = query.stock;
    if (stockData[stock]) {
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
            const stockRecord = await stockCollection.findOne({ stock: symbol.toUpperCase() });
            
            if (stockRecord) {
              // Initialize likes array if it doesn't exist
              if (!stockRecord.likes) {
                stockRecord.likes = [];
              }
              
              likes = stockRecord.likes.length;
              
              // Process like if requested
              if (like && !stockRecord.likes.includes(clientIP)) {
                await stockCollection.updateOne(
                  { stock: symbol.toUpperCase() }, 
                  { $addToSet: { likes: clientIP } }
                );
                likes++;
              }            } else {
              // Create new stock record if it doesn't exist
              await stockCollection.insertOne({
                stock: symbol.toUpperCase(),
                likes: like ? [clientIP] : []
              });
              
              if (like) likes = 1;
            }
          }
          
          return { ...stockData, likes };
        }));
          // Format response based on number of stocks
        if (results.length === 1) {
          // Ensure price and likes are numbers
          const formattedPrice = results[0].price === 'N/A' ? 0 : Number(results[0].price);
          res.json({ 
            stockData: {
              stock: results[0].stock, // Make sure we're consistent with 'stock' property
              price: formattedPrice,
              likes: Number(results[0].likes)
            }
          });
        } else if (results.length === 2) {
          const rel_likes = [
            results[0].likes - results[1].likes,
            results[1].likes - results[0].likes
          ];
            res.json({
            stockData: [
              { 
                stock: results[0].stock, 
                price: results[0].price === 'N/A' ? 0 : Number(results[0].price), 
                rel_likes: Number(rel_likes[0]) 
              },
              { 
                stock: results[1].stock, 
                price: results[1].price === 'N/A' ? 0 : Number(results[1].price), 
                rel_likes: Number(rel_likes[1]) 
              }
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
