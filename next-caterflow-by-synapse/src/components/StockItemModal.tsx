import { cachedFetch } from '@/lib/clientCache';
// components/StockItemModal.tsx
import React, { useState, useEffect } from "react";
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalCloseButton,
  ModalBody,
  ModalFooter,
  Button,
  FormControl,
  FormLabel,
  Input,
  Select,
  VStack,
  useToast,
  NumberInput,
  NumberInputField,
  NumberInputStepper,
  NumberIncrementStepper,
  NumberDecrementStepper,
  useColorModeValue,
  Alert,
  AlertIcon,
  AlertTitle,
  AlertDescription,
  Box,
  List,
  ListItem,
  Text,
} from "@chakra-ui/react";

interface StockItem {
  _id: string;
  name: string;
  sku: string;
  minimumStockLevel: number;
  unitPrice: number;
  category: {
    _id: string;
    title: string;
  };
  primarySupplier: {
    _id: string;
    name: string;
  };
  unitOfMeasure: string;
}

interface Category {
  _id: string;
  title: string;
}

interface Supplier {
  _id: string;
  name: string;
}

interface StockItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: StockItem | null;
  onSave: () => void;
  existingItems?: StockItem[]; // Add existing items for duplicate checking
}

// Smart similarity function
const calculateSimilarity = (str1: string, str2: string): number => {
  const words1 = str1
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  const words2 = str2
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 0);

  let matches = 0;
  let totalWords = Math.max(words1.length, words2.length);

  // Check for exact word matches
  words1.forEach((word1) => {
    if (
      words2.some(
        (word2) =>
          word1 === word2 || word2.includes(word1) || word1.includes(word2),
      )
    ) {
      matches++;
    }
  });

  // Also check for partial matches in the entire string
  const fullMatchScore =
    str1.toLowerCase().includes(str2.toLowerCase()) ||
    str2.toLowerCase().includes(str1.toLowerCase())
      ? 0.5
      : 0;

  return matches / totalWords + fullMatchScore;
};

const findSimilarItems = (
  itemName: string,
  existingItems: StockItem[],
  threshold: number = 0.3,
) => {
  return existingItems
    .map((item) => ({
      item,
      similarity: calculateSimilarity(itemName, item.name),
    }))
    .filter((result) => result.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5); // Show top 5 most similar
};

export default function StockItemModal({
  isOpen,
  onClose,
  item,
  onSave,
  existingItems = [],
}: StockItemModalProps) {
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [minimumStockLevel, setMinimumStockLevel] = useState(0);
  const [category, setCategory] = useState("");
  const [primarySupplier, setPrimarySupplier] = useState("");
  const [unitOfMeasure, setUnitOfMeasure] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);
  const [showSimilarItems, setShowSimilarItems] = useState(false);
  const [similarItems, setSimilarItems] = useState<
    Array<{ item: StockItem; similarity: number }>
  >([]);
  const [confirmedSave, setConfirmedSave] = useState(false);
  const toast = useToast();

  const brandColorScheme = useColorModeValue("brand", "brand");
  const neutralColorScheme = useColorModeValue("gray", "gray");
  const warningColorScheme = useColorModeValue("orange", "orange");

  // Fetch categories and suppliers
  useEffect(() => {
    const fetchData = async () => {
      setDataLoading(true);
      try {
        // Fetch categories from the correct endpoint
        const categoriesResponse = await cachedFetch("/api/categories");
        const categoriesData = await categoriesResponse.json();
        setCategories(categoriesData || []);

        // Fetch suppliers from the correct endpoint
        const suppliersResponse = await cachedFetch("/api/suppliers");
        const suppliersData = await suppliersResponse.json();
        setSuppliers(suppliersData || []);
      } catch (error) {
        console.error("Failed to fetch data:", error);
        toast({
          title: "Error",
          description: "Failed to load form data",
          status: "error",
          duration: 5000,
          isClosable: true,
        });
      } finally {
        setDataLoading(false);
      }
    };

    if (isOpen) {
      fetchData();
    }
  }, [isOpen, toast]);

  useEffect(() => {
    if (item) {
      setName(item.name || "");
      setSku(item.sku || "");
      setMinimumStockLevel(item.minimumStockLevel || 0);
      setCategory(item.category?._id || "");
      setPrimarySupplier(item.primarySupplier?._id || "");
      setUnitOfMeasure(item.unitOfMeasure || "");
    } else {
      // Reset form for new item
      setName("");
      setSku("");
      setMinimumStockLevel(0);
      setCategory("");
      setPrimarySupplier("");
      setUnitOfMeasure("");
      setConfirmedSave(false);
      setShowSimilarItems(false);
      setSimilarItems([]);
    }
  }, [item]);

  // Check for similar items when name changes (for new items only)
  useEffect(() => {
    if (!item && name.trim().length > 2) {
      const similar = findSimilarItems(name, existingItems);
      setSimilarItems(similar);
      setShowSimilarItems(similar.length > 0);
    } else {
      setShowSimilarItems(false);
      setSimilarItems([]);
    }
  }, [name, item, existingItems]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    // Check for exact duplicate (only for new items)
    if (!item) {
      const exactMatch = existingItems.find(
        (existingItem) =>
          existingItem.name.toLowerCase().trim() === name.toLowerCase().trim(),
      );

      if (exactMatch) {
        toast({
          title: "Duplicate Item",
          description: `An item with the exact name "${exactMatch.name}" already exists.`,
          status: "error",
          duration: 5000,
          isClosable: true,
        });
        return;
      }

      // Check for similar items that haven't been confirmed
      if (similarItems.length > 0 && !confirmedSave) {
        setShowSimilarItems(true);
        return;
      }
    }

    setLoading(true);

    try {
      const url = "/api/stock-items";
      const method = item ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          _id: item?._id,
          name,
          sku,
          minimumStockLevel,
          category,
          primarySupplier,
          unitOfMeasure,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save stock item");
      }

      toast({
        title: item ? "Item updated." : "Item created.",
        status: "success",
        duration: 3000,
        isClosable: true,
      });

      onSave();
      onClose();
      setConfirmedSave(false);
    } catch (error) {
      console.error("Failed to save stock item:", error);
      toast({
        title: "Error",
        description: "Failed to save stock item. Please try again.",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmSave = () => {
    setConfirmedSave(true);
    setShowSimilarItems(false);
    // Trigger save again
    setTimeout(() => {
      const fakeEvent = { preventDefault: () => {} } as React.FormEvent;
      handleSave(fakeEvent);
    }, 100);
  };

  const handleCancelSave = () => {
    setShowSimilarItems(false);
    setSimilarItems([]);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          {item ? "Edit Stock Item" : "Create Stock Item"}
        </ModalHeader>
        <ModalCloseButton />
        <form onSubmit={handleSave}>
          <ModalBody pb={6}>
            <VStack spacing={4}>
              {showSimilarItems && (
                <Alert status="warning" borderRadius="md">
                  <AlertIcon />
                  <Box flex="1">
                    <AlertTitle>Similar Items Found</AlertTitle>
                    <AlertDescription>
                      <Text mb={2}>
                        The following similar items already exist. Are you sure
                        you want to create a new item?
                      </Text>
                      <List spacing={1} maxH="120px" overflowY="auto">
                        {similarItems.map(
                          ({ item: similarItem, similarity }) => (
                            <ListItem key={similarItem._id} fontSize="sm">
                              • {similarItem.name}{" "}
                              {similarItem.sku && `(SKU: ${similarItem.sku})`}
                              <Text
                                as="span"
                                color="gray.600"
                                fontSize="xs"
                                ml={2}
                              >
                                {Math.round(similarity * 100)}% similar
                              </Text>
                            </ListItem>
                          ),
                        )}
                      </List>
                    </AlertDescription>
                  </Box>
                </Alert>
              )}

              <FormControl isRequired>
                <FormLabel>Item Name</FormLabel>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter item name"
                  isInvalid={!item && similarItems.length > 0 && !confirmedSave}
                />
              </FormControl>

              <FormControl isRequired>
                <FormLabel>SKU</FormLabel>
                <Input
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  placeholder="Enter SKU"
                />
              </FormControl>

              <FormControl isRequired>
                <FormLabel>Minimum Stock Level</FormLabel>
                <NumberInput
                  value={minimumStockLevel}
                  onChange={(value) => setMinimumStockLevel(Number(value))}
                  min={0}
                >
                  <NumberInputField />
                  <NumberInputStepper>
                    <NumberIncrementStepper />
                    <NumberDecrementStepper />
                  </NumberInputStepper>
                </NumberInput>
              </FormControl>

              <FormControl isRequired>
                <FormLabel>Category</FormLabel>
                <Select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="Select category"
                  isDisabled={dataLoading}
                >
                  {categories.map((cat) => (
                    <option key={cat._id} value={cat._id}>
                      {cat.title}
                    </option>
                  ))}
                </Select>
              </FormControl>

              <FormControl>
                <FormLabel>Primary Supplier</FormLabel>
                <Select
                  value={primarySupplier}
                  onChange={(e) => setPrimarySupplier(e.target.value)}
                  placeholder="Select primary supplier"
                  isDisabled={dataLoading}
                >
                  {suppliers.map((supplier) => (
                    <option key={supplier._id} value={supplier._id}>
                      {supplier.name}
                    </option>
                  ))}
                </Select>
              </FormControl>

              <FormControl isRequired>
                <FormLabel>Unit of Measure</FormLabel>
                <Select
                  value={unitOfMeasure}
                  onChange={(e) => setUnitOfMeasure(e.target.value)}
                  placeholder="Select unit of measure"
                >
                  <option value="kg">Kilogram (kg)</option>
                  <option value="g">Gram (g)</option>
                  <option value="l">Liter (l)</option>
                  <option value="ml">Milliliter (ml)</option>
                  <option value="each">Each</option>
                  <option value="box">Box</option>
                  <option value="case">Case</option>
                  <option value="bag">Bag</option>
                </Select>
              </FormControl>
            </VStack>
          </ModalBody>

          <ModalFooter>
            {showSimilarItems ? (
              <>
                <Button
                  colorScheme={warningColorScheme}
                  onClick={handleConfirmSave}
                  isLoading={loading}
                >
                  Yes, Create Anyway
                </Button>
                <Button
                  colorScheme={neutralColorScheme}
                  onClick={handleCancelSave}
                  ml={3}
                  variant="ghost"
                >
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button
                  colorScheme={neutralColorScheme}
                  mr={3}
                  onClick={onClose}
                  isDisabled={loading}
                  variant="ghost"
                >
                  Cancel
                </Button>
                <Button
                  colorScheme={brandColorScheme}
                  type="submit"
                  isLoading={loading}
                  isDisabled={dataLoading}
                >
                  {item ? "Update Item" : "Create Item"}
                </Button>
              </>
            )}
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}
